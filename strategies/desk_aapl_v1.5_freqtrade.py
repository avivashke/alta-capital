# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: מניות · Apple (יומי) · AAPL · 1d
# Version: v1.5 · Strategy family: rsi_reversion
# Backtest: return 27.61% · PF 3.17 · DD 4.2% · trades 27
# OOS: 15.49% · Sharpe 1.02
# Params: {"period":22,"oversold":35,"overbought":74,"atrStop":1.3,"rr":1.7}
# Target platform: Freqtrade
# Generated: 2026-11-24T18:49:08.897Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_aapl --config user_data/config.json
#   freqtrade trade --strategy Altadesk_aapl --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_aapl(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '1d'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.016
    minimal_roi = {"0": 1.53, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=22)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 35)
        & (dataframe['rsi'].shift(1) > 35)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 74)
        & (dataframe['rsi'].shift(1) < 74)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 35)
        & (dataframe['rsi'].shift(1) > 35)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 74)
        & (dataframe['rsi'].shift(1) < 74)
            ),
            'exit_long',
        ] = 1
        return dataframe
