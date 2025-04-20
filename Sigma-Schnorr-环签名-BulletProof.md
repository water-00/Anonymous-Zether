### Sigma Protocol

协议内容: prover要证明自己知道离散对数问题$A=g^a$的解, 同时不暴露$a$是什么.

<img src="img_md/640-20210506203052314.png" alt="图片" style="zoom: 50%;" />

协议流程: prover给出承诺$B=g^b$, verifier给出挑战$c$, prover给出response $r=a\cdot c+b$, verifier根据$r$验证. 一般的验证方式是计算
$$
g^r\overset{?}=g^{a\cdot c+b}=A^c B
$$
观察流程可以知道一开始prover发送的对$b$的承诺$B$是为了随机化$a\cdot c$, $r = a\cdot c+b$, 有了$b$这一项保证verifier无法通过$r$和$c$打开$a$.

协议性质:

1.   completeness: prove如果知道$a$, 那么就能通过verifier验证

2.   soundness: prover如果不知道$a$, 那么就不可能通过verifier验证

     >   证明如下:
     >   $$
     >   r_1=a\cdot c_1+b\\
     >   r_2=a\cdot c_2+b\\
     >   a=(r_1-r_2)\cdot(c_1-c_2)^{-1}
     >   $$
     >   verifier给出两次$c_1,c_2$就可以根据prover返回的$r_1,r_2$求出一个$a$. 如果prover不知道$a$, 那根据离散对数问题的困难性, prover连续给出两次正确$r_1,r_2$的概率是可忽略的.

3.   zero-knowledge

协议有一个需要注意的地方, 如果在prover给出承诺$B$之前, verifier就给出了挑战$c$, 那么prover在不知道$a$的情况下也能伪造能通过证明$(r,B)$:
$$
g^r = g^{a\cdot c+b}\Rightarrow g^b = g^{r-a\cdot c}\Rightarrow B=g^r/A^c
$$
在verifier给出挑战$c$后, prover随机采样一个response $r$, 然后生成上面的$B$, 就能通过verifier的验证.

### Fiat-Shamir变换

Sigma Protocol是交互式的, 我想把它改成非交互式的, 即挑战$c$也由prover生成. 但是上面已经说明了如果prover在给出承诺$B$之前就生成了挑战$c$, 那么它可以作假. 因此非交互式协议必须保证prover一定是先生成承诺$B$, 再生成挑战$c$. 怎么实现呢? 用$B$的哈希生成$c$就好了. 所以prover依次生成:

1.   $B=g^b$
2.   $c=H(B)$
3.   $r=a\cdot c+b$

verifier还是验证
$$
g^r\overset{?}=g^{a\cdot c+b}=A^c B
$$
在第二步中可以改为生成$c=H(B,m)$, 将消息$m$加入到协议证明中.

### Schnorr Protocol

椭圆曲线上的Sigma Protocol

prover保存私钥$\alpha$, 对应的公钥$u=g^\alpha$, prover证明自己知道$\alpha$但不暴露$\alpha$.

<img src="img_md/v2-93f6910f4e70bc1c25368a68b9e46b11_r.jpg" alt="img" style="zoom: 20%;" />

非交互式下prover签名消息$m$的生成流程:

1.   生成对随机数$\alpha_t$的承诺$u_t$
2.   生成包含消息$m$的挑战$c = H(u_t\mid\mid m)$
3.   计算响应$\alpha_z = \alpha_t + \alpha\cdot c$

verifier验证
$$
g^{\alpha_z}\overset{?}=g^{\alpha_t + \alpha\cdot c} = u_t\cdot u^c
$$
私钥$\alpha$对消息$m$的签名就是$S = (u_t,\alpha_z)$.

### 环签名

设私钥列表为$(\text{sk}_1,\cdots,\text{sk}_n)$, 公钥列表为$(\text{pk}_1,\cdots,\text{pk}_n)$, 其中$\text{pk}_i=g^{\text{sk}_i}$. 私钥列表对消息$m$分别签名, 生成签名列表$(S_1,\cdots,S_n)$.

签名流程可以保证: prover只拥有$(\text{sk}_1,\cdots,\text{sk}_n)$中的一个私钥, 但是能签出$(S_1,\cdots,S_n)$, 并且在验证时不知道prover拥有的是其中的哪一个私钥. 具体流程如下:

1.   初始化承诺: $B_1 = g^{b_1}$
2.   构造环中每个元素签名:
     - 用前者的承诺生成挑战$c_i = H(B_{i-1}\mid\mid m)$ for $i\in[2,n]$
     - 随机采样响应$r_i$
     - 生成满足挑战和响应的承诺$B_i = g^{r}/ (\text{pk}_i)^{c_i}$
     - 构造签名$S_i = (B_i,r_i)$
3.   用整个环的信息构造初始元素的挑战和响应: $c_1 = H(B_n\mid\mid m), r_1 = \text{sk}_1\cdot c_1+b_1$, 构造签名$S_1 = (B_1,r_1)$.

注意步骤2中用到了Sigma Protocol笔记部分的性质: 如果先给出挑战$c$, 那么prover可以在不知道私钥$\text{sk}$的情况下随机生成响应$r$, 然后构造$B = g^r/\text{pk}^c$使得verifier的验证$g^r\overset{?}= \text{pk}^c\cdot B$被通过.

验证时verifier可以从任意一个签名开始验证, for $i\in[1,n]$验证
$$
g^{r_i}\overset{?}= (\text{pk}_i)^{c_i}B_i
$$
如果全通过说明环签名通过, 证明prover知道私钥列表中的一个私钥, 但不会暴露prover知道的是哪一个. 如果prover一个私钥都不知道, 那就无法正确给出流程中初始元素的响应$r_1 = \text{sk}_1\cdot c_1+b_1$, 在验证$g^{r_1}\overset{?}= (\text{pk}_1)^{c_1}B_1$对恶意的prover来说是离散对数问题.

### 用Sigma Protocol校验El Gamal转账密文

Alice给Bob转账$m$ token, 发送方和接收方的余额变化信息密文分别为$(C,D_0) = (g^r, \text{pk}_A^r\cdot g^{m_0})$和$(C,D_1) = (g^r, \text{pk}_B^r\cdot g^{m_1})$, 理论上如果Alice没有作恶, 那么应当满足$m_0=m_1$, 我们设计一个Sigma协议以零知识的方式证明这一点.

1.   prover选择$m=m_0=m_1$作为Sigma协议的输入

     prover选择随机数$r^\prime$, 给出对$r$的承诺$C^\prime$和对$m_0, m_1$的承诺$D_0^\prime, D_1^\prime$:
     $$
     C^\prime = g^{r^\prime}, D_0^\prime=\text{pk}_A^{r^\prime}\cdot g^{m}, D_1^\prime=\text{pk}_B^{r^\prime}\cdot g^{m}
     $$
     verifier给出挑战$e=H(\text{pk}_A, \text{pk}_B, C,D_0,D_1, C^\prime, D_0^\prime, D_1^\prime)$.

     prover计算响应$z= r^\prime+e\cdot r, \tilde m = m  + e\cdot m$, 发送数据为$\{C^\prime,D_0^\prime,D_1^\prime, z,\tilde m\}$.

     verifier验证:
     $$
     g^{z}\overset{?}=g^{r^\prime+e\cdot r}=C^\prime\cdot C^e\\
     g^{\tilde m}\cdot \text{pk}_A^z \overset{?}=g^{m+e\cdot m}\cdot \text{pk}_A^{r^\prime+e\cdot r}=D_0^e\cdot D_0^\prime\\
     g^{\tilde m}\cdot \text{pk}_B^z \overset{?}=g^{m+e\cdot m}\cdot \text{pk}_B^{r^\prime+e\cdot r}=D_1^e\cdot D_1^\prime
     $$
     能通过, 但问题可以从是公开的响应$\tilde m$和挑战$e$算出$m = \tilde m/(1+e)$.

2.   prover选择随机数$m^\prime$作为Sigma协议的输入

     prover开始给出的承诺:
     $$
     C^\prime = g^{r^\prime}, D_0^\prime=\text{pk}_A^{r^\prime}\cdot g^{m^\prime}, D_1^\prime=\text{pk}_B^{r^\prime}\cdot g^{m^\prime}
     $$
     verifier给出挑战$e=H(\text{pk}_A, \text{pk}_B, C,D_0,D_1, C^\prime, D_0^\prime, D_1^\prime)$

     prover计算响应$z= r^\prime+e\cdot r, \tilde m_0 = m^\prime + e\cdot m_0, \tilde m_1 = m^\prime + e\cdot m_1$, 发送数据为$\{C^\prime,D_0^\prime,D_1^\prime, z,\tilde m_0, \tilde m_1\}$.

     verifier验证:
     $$
     g^{z}\overset{?}=C^\prime\cdot C^e\\
     g^{\tilde m_0}\cdot \text{pk}_A^z \overset{?}=D_0^e\cdot D_0^\prime\\
     g^{\tilde m_1}\cdot \text{pk}_B^z \overset{?}=D_1^e\cdot D_1^\prime
     $$
     外人就无法从响应$\tilde m_0, \tilde m_1$中获取$m_0, m_1$了. 也就是说Sigma协议中prover开始给出的承诺不能用信息的具体值, 否则会在响应的构造中暴露该值; prover只能生成基于随机数的承诺, 然后在响应中使用该随机数掩盖真值.

### 向量內积的Sigma协议

一些定义: 随机数向量$\vec a = (a_1,\cdots,a_n)\in \mathbb Z_p^n$, 生成元$\vec g = (g_1,\cdots,g_n), \vec h = (h_1,\cdots,h_n)\in \mathbb G^n$ (每个$g_i$的x轴是一个哈希值, 比如hash(“g”, i), 然后去求出这个x在椭圆曲线上的y得到$g_i$). 则对$\vec a$的承诺为
$$
C = \vec g^{\vec a} = \prod\limits ^n_{i=1}g_i^{a_i}\in\mathbb G
$$
承诺没有隐藏性, 缺少随机项, 故引入随机数向量$\vec b=(b_1,\cdots,b_n)\in\mathbb Z_p^n$, 另$g_i^\prime = g_i^{b_i^{-1}}$, 则$C=\prod\limits^n_{i=1}(g_i^\prime)^{a_ib_i}\in\mathbb G$.

slice记号: $\vec a_{[:l]} = (a_1\cdots,a_l)\in\mathbb F^l, \vec a_{[l:]} = (a_{l+1}\cdots,a_n)\in\mathbb F^{n-l}$, $n$满足$n=2^k$.

非零幂向量: $k\in\mathbb Z_p^*, \vec k^n = (1,k,\cdots,k^{n-1})\in(\mathbb Z_p^*)^n, \vec k^{-n} = (1,k^{-1},\cdots,k^{-(n-1)})\in(\mathbb Z_p^*)^n$.

>   比如$k=2$, 就得到$\vec 2^n = (1,2,\cdots,2^{n-1})\in(\mathbb Z_p^*)^n$, 代码里出现过的向量.

prover给出Pederson承诺$P_1$和內积$c$, 证明自己知道秘密向量$\vec a, \vec b\in\mathbb Z^n_p$, 以下$3$个运算关系等价:

1.   $P_1 = \vec g^{\vec a}\cdot \vec h^{\vec b}, c = \lang\vec a, \vec b\rang$. 其中$P_1$相当于对两个向量$\vec a, \vec b$同时做了Pederson承诺的结果.

     verifier可以通过拆开$\vec a, \vec b$来校验$P_1, c$是否成立, 但是prover发送的数据量为$2n$.

2.   构造新关系$P_1 = \vec g^{\vec a}\cdot \vec h^{\vec b}\cdot u^c$, 如果这个关系能通过验证等价于1中的关系$P_1, c$通过验证

3.   为了减少计算量, 定义将$n$折半的哈希函数, 令$n^\prime = n/2$, $\vec a_1, \vec a_2, \vec b_1, \vec b_2\in\mathbb Z_p^{n^\prime}$, 定义同态哈希函数
     $$
     H(\vec a_1, \vec a_2, \vec b_1, \vec b_2, c) =\vec g_{[:n^\prime]}^{\vec a_1}\cdot g_{[n^\prime:]}^{\vec a_2}\cdot h_{[:n^\prime]}^{\vec b_1}\cdot h_{[n^\prime:]}^{\vec b_2}\cdot u^c
     $$

     >   注意函数$H$返回的是一个椭圆曲线点$(x,y)\in \mathbb G$, 并不是真的哈希值. 这里面每一项幂指数$\vec g^{\vec a}$也都是一个椭圆曲线点. 假设$n=64$, $g_{[:n^\prime]}^{\vec a_1}$实际上做的运算就是$\sum\limits^{31}_{i=0}g_i\cdot a_i$, $g$的每个分量$g_i$ (一个椭圆曲线点) 乘以标量$a_i$得到点, 再把这些点坐标求和. 再把这5个点坐标求和得到最后的坐标.

     容易验证它具有以下同态性:
     $$
     \begin{align*}
     H(\vec a_1, \vec a_1^\prime, \vec b_1, \vec b_1^\prime, c_1)\cdot H(\vec a_2, \vec a_2^\prime, \vec b_2, \vec b_2^\prime, c_2) &= H(\vec a_1+\vec a_2,\vec a_1^\prime+ \vec a_2^\prime, \vec b_1+\vec b_2, \vec b_1^\prime+\vec b_2^\prime, c_1+c_2)\\
     \end{align*}
     $$
     类似地, 2中的关系可以等价表达为以下形式:
     $$
     \begin{align*}
     P_1 &= H(\vec a_{[:n^\prime]}, \vec a_{[n^\prime:]}, \vec b_{[:n^\prime]}, \vec b_{[n^\prime:]}, \lang\vec a, \vec b\rang)\\
     证明:\\
     P_1&= \vec g_{[:n^\prime]}^{\vec a_{[:n^\prime]}}\cdot g_{[n^\prime:]}^{\vec a_{[n^\prime:]}}\cdot h_{[:n^\prime]}^{\vec b_{[:n^\prime]}}\cdot h_{[n^\prime:]}^{\vec b_{[n^\prime:]}}\cdot u^{\lang\vec a, \vec b\rang}\\
     &=\vec g^{\vec a}\cdot \vec h^{\vec b}\cdot u^{\lang\vec a, \vec b\rang}
     \end{align*}
     $$

     >   其实就是把$g^{\vec a} = \prod\limits ^n_{i=1}g_i^{a_i}$的连乘 (求和) 分成了前后两部分来算: $g^{\vec a} = \prod\limits ^n_{i=1}g_i^{a_i}=\prod\limits^{n^\prime}_{i=1}g_i^{a_i}\cdot\prod\limits^{n}_{j=n^\prime+1}g_j^{a_j} = \vec g_{[:n^\prime]}^{\vec a_{[:n^\prime]}}\cdot g_{[n^\prime:]}^{\vec a_{[n^\prime:]}}$.

     就把证明关系$P_1$等价转换为了哈希函数的表示形式.

接下来, 我们用**响应不断折半**的方式减少prover需要发送, verifier需要打开的数据量 (最开始是完整发送, 打开$\vec a, \vec b$, 数据量为$2n$), 过程如下:

 第1轮:

prover要用Sigma Protocol的形式证明自己知道$\vec a, \vec b$, 满足
$$
P_1 = H\left(\vec a_{[:n^\prime]}, \vec a_{[n^\prime:]}, \vec b_{[:n^\prime]}, \vec b_{[n^\prime:]}, \lang\vec a, \vec b\rang\right)\quad \boxed{1}
$$

-   prover给出承诺: 
    $$
    L_1 = H\left(0^{n^\prime}, \vec{a}_{[:n^\prime]}, \vec{b}_{[n^\prime:]}, 0^{n^\prime}, \lang\vec{a}_{[:n^\prime]}, \vec{b}_{[n^\prime:]}\rang \right) = \vec{g}^{0^{n^\prime}}_{[:n^\prime]} \cdot \vec{g}^{\vec a_{[:n^\prime]}}_{[n^\prime:]} \cdot \vec{h}^{\vec b_{[n^\prime:]}}_{[:n^\prime]} \cdot \vec{h}^{0^{n^\prime}}_{[n^\prime:]} \cdot u^{\lang\vec{a}_{[:n^\prime]}, \vec{b}_{[n^\prime:]}\rang}\\
    
    R_1 =H\left(\vec a_{[n^\prime:]}, 0^{n^\prime}, 0^{n^\prime}, \vec b_{[:n^\prime]}, \lang\vec{a}_{[n^\prime:]}, \vec{b}_{[:n^\prime]}\rang\right) = \vec{g}^{\vec a_{[n^\prime:]}}_{[:n^\prime]} \cdot \vec{g}^{0^{n^\prime}}_{[n^\prime:]} \cdot \vec{h}^{0^{n^\prime}}_{[:n^\prime]} \cdot \vec{h}^{\vec b_{[:n^\prime]}}_{[n^\prime:]} \cdot u^{\lang\vec{a}_{[n^\prime:]}, \vec{b}_{[:n^\prime]}\rang}
    $$

    >   分别令$\vec a, \vec b$的一半等于0, 并且打乱$\vec a, \vec b$前后一半的顺序.

-   verifier给出挑战:
    $$
    x_1 = SHA3(P_1, L_1, R_1) \mod p \in \mathbb{Z}_p
    $$

    >   用真哈希函数生成一个随机数$x_1$.

-   prover给出折半响应:
    $$
    \vec{a}^\prime = x_1 \vec{a}_{[:n^\prime]} + x_1^{-1} \vec{a}_{[n^\prime:]}\\
    \vec{b}^\prime = x_1 \vec{b}_{[:n^\prime]} + x_1^{-1} \vec{b}_{[n^\prime:]}
    $$
    prover发送承诺$L_1, R_1$和响应$\vec a^\prime, \vec b^\prime$.

-   verifier校验一致性:
    $$
    L_1^{(x_1^2)} \cdot P_1 \cdot R_1^{(x_1^{-2})} \overset{?}= H\left(x_1^{-1} \vec{a}^\prime, x_1 \vec{a}^\prime, x_1 \vec{b}^\prime, x_1^{-1} \vec{b}^\prime, \lang\vec{a}^\prime, \vec{b}^\prime\rang\right) \quad \boxed{2}
    $$
    这个等式成立等价于$\boxed{1}$成立, 证明过程:

    <img src="img_md/image-20250416163522926.png" alt="image-20250416163522926" style="zoom: 80%;" />

    >   基本上就是把$\boxed{2}$的右边代入$H$函数展开, 然后把折半响应拆开来, 就等于左边. 

这样, 在不进行折半响应之前prover发送的数据是$\vec a, \vec b$, 长度为$2n$, 现在发送的数据为$L_1, R_1, \vec a^\prime, \vec b^\prime$, 长度为$2+n$.

第2轮:

prover要用Sigma Protocol证明自己知道$\vec a^\prime, \vec b^\prime$, 满足
$$
P_2 = L_1^{(x_1^2)} \cdot P_1 \cdot R_1^{(x_1^2)} = H\left(x_1^{-1} \vec{a}^\prime, x_1 \vec{a}^\prime, x_1 \vec{b}^\prime, x_1^{-1} \vec{b}^\prime, \lang\vec{a}^\prime, \vec{b}^\prime\rang\right)
$$
prover依然计算承诺$L_2,P_2$, verifier计算随机数挑战$x_2$, prover计算折半响应$\vec a^{\prime\prime}, \vec b^{\prime\prime}$, prover要发送的数据为$(L_1,R_1),(L_2,R_2),\vec a^{\prime\prime}, \vec b^{\prime\prime}$, 总长度就变成了$4+\dfrac{n}{2}$. 

以此类推, 经过k轮, prover发送的所有承诺和折半响应为$(L_1,R_1),\cdots,(L_k,R_k),\vec a^{(k)}, \vec b^{(k)}$, 其中$k=\log_2 n$, 所以$\vec a^{(k)}, \vec b^{(k)}$实际上为标量. 总数据长度为$2k+2$. verifier要验证的关系为
$$
(L_k)^{x_k^2}\cdot P_k\cdot (R_k)^{x_k^{-2}}\overset{?}=H(x_k^{-1}\vec a^{(k)}, x_k\vec a^{(k)}, x_k\vec b^{(k)}, x_k^{-1}\vec b^{(k)}, \lang\vec a^{(k)},\vec b^{(k)} \rang)
$$
如果把$P_k$替换为$P_1$:
$$
\begin{align*}
P_k &= \left(L_{k-1}\right)^{x_{k-1}^2}\cdot P_{k-1}\cdot \left(R_{k-1}\right)^{x_{k-1}^{-2}}\\
&=\cdots\\
&=\prod\limits_{i=1}^{k-1}(L_i)^{x_{i}^2}\cdot P_{1}\cdot \prod\limits_{i=1}^{k-1}(R_i)^{x_{i}^{-2}}
\end{align*}
$$
代入上式即可. 所以也可以理解为每一轮折半都是用$L_i, R_i$更新$P_i$至$P_{i+1}$, 然后verifier验证
$$
P_{i+1}\overset{?} = H(x_i^{-1}\vec a^{(i)}, x_i\vec a^{(i)}, x_i\vec b^{(i)}, x_i^{-1}\vec b^{(i)}, \lang\vec a^{(i)},\vec b^{(i)} \rang)
$$

### BulletProof范围证明

-   Sigma Protocol: 1个承诺, 1个挑战, 1个响应, 1个校验
-   BulletProof: 4个承诺 , 3个挑战, 5个响应, 3个校验

整个范围证明的过程就是要把“直观, 不好证明”的式子$\boxed{1}$等价转换为“不直观, 很好证明”的式子$\boxed{6}$.

prover要证明金额为$v$, 随机数$\gamma$满足
$$
V=g^vh^\gamma,\\
v\in[0,2^n-1]\quad \boxed{1}
$$
其中$V$是对$v,\gamma$的Pederson承诺. 把$v$写成二进制$\vec {a}_L = (a_1,\cdots,a_n)$, 则有$v=\lang\vec a_L,\vec 2^n\rang$, 引入$\vec a_L$的正交向量$\vec a_R$来确保$\vec a_L$是二进制向量:
$$
\lang\vec a_L,\vec 2^n\rang=v,\vec a_L\odot\vec a_R = \vec 0^n,\vec a_R = \vec a_L-\vec 1^n\quad \boxed{2}
$$

-   第一个式子保证$v$的二进制展开为$\vec a_L$
-   第二个式子保证向量正交
-   第三个式子保证$\vec a_L,\vec a_R$是二进制表示.

选择随机数$y\in\mathbb Z_p$, 将$\boxed{2}$用內积表达:
$$
\lang\vec a_L,\vec 2^n\rang=v,\lang \vec a_L,\vec a_R\odot\vec y^n\rang = 0,\lang\vec a_L-\vec 1^n - \vec a_R, \vec y^n\rang = 0\quad \boxed{3}
$$
选取随机数$z\in\mathbb Z_p$, 将三个等式线性组合:
$$
z^2\lang\vec a_L,\vec 2^n\rang + z\lang\vec a_L-\vec 1^n - \vec a_R, \vec y^n\rang + \lang \vec a_L,\vec a_R\odot\vec y^n\rang = z^2\cdot v\quad \boxed{4}
$$
对左边做因式合并, 硬凑出如下的內积表达形式:
$$
\lang\vec a_L-z\cdot \vec 1^n,\vec y^n\odot(\vec a_R+z\cdot\vec 1^n) + z^2\cdot\vec 2^n \rang = z^2\cdot v + \delta(y,z)\quad \boxed{5}
$$
其中$\delta(y,z) = (z-z^2)\lang\vec 1^n,\vec y^n\rang - z^3\lang\vec 1^n,\vec 2^n\rang\in\mathbb Z_p$. 其中$z^2\cdot v$这一项verifier是算不出来的, $\delta(y,z)$这一项verifier是可以算出来的.

BulletProof流程:

1.   prover发送承诺:

     -   计算金额向量$\vec a_L\in\mathbb Z_p^n$, 满足$\lang\vec a_L,\vec 2^n\rang=v$

         $\vec a_R = \vec a_L - 1\in\mathbb Z_p^n$.

     -   选择随机数$\alpha\in\mathbb Z_p$, 计算对$\vec a_L, \vec a_R$的承诺$A = h^\alpha\cdot\vec g^{\vec a_L}\cdot \vec h^{\vec a_R}\in\mathbb G$.

     -   选取对$\vec a_L, \vec a_R$随机化的随机数向量$\vec s_L,\vec s_R\in\mathbb Z_p^n$, 并选取随机数$\rho\in\mathbb Z_p$, 计算对$\vec s_L,\vec s_R$的承诺$S=h^\rho\cdot\vec g^{\vec s_L}\cdot \vec h^{\vec s_R}\in\mathbb G$

     发送承诺$A,S$

2.   verifier计算挑战:

     计算两个随机数$y,z=\text{SHA256}(V,g,h,A,S,i),i=1,2$.

3.   prover计算响应:

     根据$\vec a_L, \vec a_R, \vec s_L,\vec s_R$构造向量多项式
     $$
     \begin{align*}
     l(X) &= (\vec a_L-z\cdot \vec 1^n)+\vec s_L\cdot X\\
     r(X) &= \vec y^n\odot(\vec a_R+z\cdot\vec 1^n + \vec s_R\cdot X) + z^2\cdot\vec 2^n 
     \end{align*}
     $$
     以及多项式內积$t(X) = \lang l(X),r(X)\rang = t_0+t_1X+t_2X^2$. 可以发现$l(X), r(X)$的常数项就是式$\boxed 5$中的两项, 所以有
     $$
     t_0 = z^2\cdot v + \delta(y,z)\quad \boxed{6}
     $$
     至此, 式$\boxed 1$至式$\boxed 6$等价, prover只需证明自己知道$v$使得式$\boxed 6$成立.

     prover需要以Sigma Protocol的形式发送$t_1,t_2$, 因此

     1.   prover发送对$t_1,t_2$的承诺:

          选取随机数$\tau_1,\tau_2\in\mathbb Z_p$, 计算承诺$T_1 = g^{t_1}\cdot h^{\tau_1}, T_2=g^{t_2}\cdot h^{\tau_2}$

          发送$T_1,T_2$.

     2.   verifier发送挑战$x=\text{SHA256}(V,g,h,A,S,T_1,T_2)$.

     3.   prover基于挑战$x,y,z$计算并发送5个响应:

          -   $\vec l= l(x) = \vec a_L-z\cdot \vec 1^n + \vec s_L\cdot x\in\mathbb Z_p^n$

          -   $\vec r = r(x) = \vec y^n\odot(\vec a_R+z\cdot\vec 1^n + \vec s_R\cdot x) + z^2\cdot\vec 2^n \in\mathbb Z_p^n$

          -   $\hat t = \lang\vec l,\vec r\rang\in\mathbb Z_p$

          -   $\tau_x =\tau_2\cdot x^2 +\tau_1\cdot x+z^2\gamma\in\mathbb Z_p$

          -   $\mu = \alpha+\rho x\in\mathbb Z_p$

          >   $\vec l, \vec r, \hat t$是对金额向量, 随机数向量$\vec a_L, \vec a_R, \vec s_L,\vec s_R$的响应; $\tau_x$是对承诺$v, t_1,t_2$时选的随机数$\gamma, \tau_1, \tau_2$的响应; $\mu$是对承诺$\vec a_L, \vec a_R, \vec s_L,\vec s_R$时选的随机数$\alpha,\rho$的响应.

4.   verifier校验:

     verifier计算$h_i^\prime = h_i^{y^{-i+1}}\in\mathbb G$, 构造向量$\vec h^\prime = (h^\prime_1,\cdots,h^\prime_n)$

     计算承诺$P=A\cdot S^x\cdot \vec g^{-z}\cdot(\vec h^\prime)^{z\cdot \vec y^n+z^2\cdot\vec 2^n}$.

     进行如下3个校验:

     -   $g^{\hat t}\cdot h^{\tau_x}\overset{?}=V^{z^2}\cdot g^{\delta(y,z)}\cdot T_1^x\cdot T_2^{x^2}$
     -   $P\overset{?}=h^{\mu}\cdot\vec g^{\vec l}\cdot(\vec h^\prime)^{\vec r}$
     -   $\hat t\overset{?} = \lang\vec l, \vec r\rang$

     公式1推导:
     $$
     \begin{align*}
     V^{z^2}\cdot g^{\delta(y,z)}\cdot T_1^x\cdot T_2^{x^2}&=(g^vh^\gamma)^{z^2}\cdot g^{\delta(y,z)}\cdot (g^{t_1}h^{\tau_1})^x\cdot (g^{t_2}h^{\tau_2})^x\\
     &= g^{z^2v + xt_1+x^2t_2+\delta(y,z)}\cdot h^{z^2\gamma+x\tau_1+x^2\tau_2}\\
     &\overset{?} = g^{\hat t}\cdot h^{\tau_x}
     \end{align*}
     $$
     本质上是在验证$\hat t = t_0+t_1x+t_2x^2$. 如果通过说明式$\boxed 6$正确.

     公式2推导:
     $$
     \begin{align*}
     P &= A\cdot S^x\cdot \vec g^{-z}\cdot(\vec h^\prime)^{z\cdot \vec y^n+z^2\cdot\vec 2^n}\\
     &= (h^\alpha\cdot\vec g^{\vec a_L}\cdot \vec h^{\vec a_R})\cdot (h^\rho\cdot\vec g^{\vec s_L}\cdot \vec h^{\vec s_R})^x\cdot \vec g^{-z}\cdot(\vec h^\prime)^{z\cdot \vec y^n+z^2\cdot\vec 2^n}\\
     &=h^{\alpha+\rho x}\cdot\vec g^{\vec a_L-z\cdot\vec 1^n+\vec s_L\cdot x}\cdot \vec h^{\vec a_R-z\cdot \vec 1^n+\vec s_R\cdot x}\cdot(\vec h^\prime)^{z\cdot \vec y^n+z^2\cdot\vec 2^n}\\
     &\overset{?}= h^{\mu}\cdot\vec g^{\vec l}\cdot(\vec h^\prime)^{\vec r}
     \end{align*}
     $$
     确保响应向量$\vec l, \vec r$是基于$\vec a_L,\vec a_R$算出来的, 即满足
     $$
     \begin{align*}
     \vec l&=l(x) = \vec a_L-z\cdot \vec 1^n + \vec s_L\cdot x\in\mathbb Z_p^n\\
     \vec r &= r(x) = \vec y^n\odot(\vec a_R+z\cdot\vec 1^n + \vec s_R\cdot x) + z^2\cdot\vec 2^n \in\mathbb Z_p^n
     \end{align*}
     $$
     公式3: 保证$\hat t $是基于$\vec l, \vec r$算出来的.

总结: prover发送承诺$A, S, T_1, T_2$; verifier发送挑战$x,y,z$; prover发送响应$\vec l, \vec r, \hat t,\tau_x,\mu$; verifier验证三个等式.

优化: 响应$\vec l, \vec r$是$n$维向量, 可以用折半响应将发送数据长度从$2n$缩减为$2\log_2 n+2$. 校验等式2就需要对应改为折半响应下的形式了.

### 批量范围证明

证明方知道$m$个秘密$v_j,\gamma_j$, 满足关系
$$
\begin{align*}
V_j &= g^{v_j}h^{\gamma_j}\\
v_j &\in[0,2^n-1],j=1,\cdots,m
\end{align*}
$$
需要修改的部分:

prover提供部分:

$\vec a_L = \{0,1\}^{n\cdot m}$, 满足$\lang\vec a_L[(j-1)n:jn-1],\vec 2^n\rang=v_j$

$\vec a_R = \vec a_L-1\in\mathbb Z_p^{n\cdot m}$

$l(X) = (\vec a_L-z\cdot \vec 1^{n\cdot m})+\vec s_L\cdot X\in\mathbb Z_p^{n\cdot m}[X]$

$r(X) = \vec y^{n\cdot m}\odot(\vec a_R+z\cdot\vec 1^{n\cdot m} + \vec s_R\cdot X) +\sum\limits_{j=1}^mz^{1+j}(\vec 0^{(j-1)n}\mid\mid\vec 2^n\mid\mid\vec 0^{(m-j)n}) \in\mathbb Z^{n\cdot m}_p[X]$

>   对这一项的理解是, $(\vec 0^{(j-1)n}\mid\mid\vec 2^n\mid\mid\vec 0^{(m-j)n})$长度是$m\cdot n$, 但只有$n$长度的$\vec 2^n$是非0值, 根据索引$j$决定把这个$\vec 2^n$放在什么位置.

$\tau_x = \tau_1x+\tau_2x^2+\sum\limits_{j=1}^m(z^{1+j}\gamma_j)$

$\delta(y,z) = (z-z^2)\lang\vec 1^{n\cdot m}, \vec y^{n\cdot m}\rang-\sum\limits_{j=1}^m(z^{1+j}\lang\vec 1^n,\vec 2^n\rang)$

verifier验证部分:

$g^{\hat t}\cdot h^{\tau_x}\overset{?}=\vec V^{z^2\cdot\vec z^m}\cdot g^{\delta(y,z)}\cdot T_1^x\cdot T_2^{x^2}$, $\vec V = (V_1,\cdots,V_m)$.

$P=A\cdot S^x\cdot \vec g^{-z}\cdot(\vec h^\prime)^{z\cdot \vec y^{n\cdot m}}\prod\limits^m_{j=1}(\vec h^\prime)^{z^{j+1}\cdot 2^n}_{(j-1)n:jn-1}$

### PriDe CT协议

<img src="img_md/image-20250417042330847.png" alt="image-20250417042330847" style="zoom:80%;" />

<img src="img_md/image-20250417042352457.png" alt="image-20250417042352457" style="zoom:80%;" />

<img src="img_md/image-20250417042420906.png" alt="image-20250417042420906" style="zoom: 67%;" />

-   1-8: prover对$\vec a_L,\vec a_R, \vec s_L,\vec s_R$生成承诺$A,S$
-   9: verifier发送挑战$y,z$
-   10-14: prover对挑战$y,z$生成响应$t_1,t_2$, 并以Sigma Protocol的方式发送
    -   prover先发送对$t_1,t_2$的承诺$T_1,T_2$
    -   15: verifier发送挑战$x$
    -   16-20: prover对挑战$x,y,z$生成响应$\vec l, \vec r, \hat t,\tau_x,\mu$

新一轮Sigma Protocol:

-   21-26: prover采样随机数$k_{\text{sk}},k_r,k_\tau,k_b$, 生成对这些随机数的承诺$A_C, A_y,A_b,A_X,A_\tau$
-   27: verifier发送挑战$c$
-   28-31: prover生成响应.
-   32-37: verifier的校验

对校验等式的说明:

34: $D_0^\prime$是个什么玩意儿? 根据它给出的式子反推$D_0^\prime = \text{nC}_0^{\text{sk}}\cdot g^{pl_{t^\prime-1}} = \text{pk}_0^{r+x}\cdot g^{pl_{t^\prime-1}}$, 那$t^\prime-1$又是什么东西??

$D_0 = C^{\text{sk}}\cdot g^{-pl_0}$

$D_j = \text{pk}_j^r\cdot g^{pl_j}$

$\text{nD}_0 = \text{nC}_0^{\text{sk}}\cdot g^{b-pl}$

<img src="img_md/image-20250417150204996.png" alt="image-20250417150204996" style="zoom:67%;" />
